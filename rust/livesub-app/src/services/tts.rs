use crate::state::{get_re_ws, AppState};
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

fn generate_conn_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:032x}", nanos)
}

pub async fn synthesize_edge_tts(voice: &str, text: &str) -> Option<Vec<u8>> {
    let conn_id = generate_conn_id();
    let url = format!(
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId={}",
        conn_id
    );

    let mut request = url.into_client_request().ok()?;
    let headers = request.headers_mut();
    headers.insert(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
            .parse()
            .ok()?,
    );
    headers.insert(
        "Origin",
        "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold".parse().ok()?,
    );
    headers.insert("Pragma", "no-cache".parse().ok()?);
    headers.insert("Cache-Control", "no-cache".parse().ok()?);

    let (mut ws_stream, _) = tokio::time::timeout(
        std::time::Duration::from_millis(3500),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .ok()?
    .ok()?;

    let config_msg = "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
    ws_stream.send(Message::Text(config_msg.into())).await.ok()?;

    let (voice_name, pitch) = match voice {
        v if v.contains("Thái Sơn") || v.contains("NamMinh") => ("vi-VN-NamMinhNeural", "-4Hz"),
        v if v.contains("Thiện Minh") => ("vi-VN-NamMinhNeural", "+0Hz"),
        v if v.contains("Thùy Dung") => ("vi-VN-HoaiMyNeural", "-3Hz"),
        _ => ("vi-VN-HoaiMyNeural", "+0Hz"),
    };

    let escaped_text = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");

    let req_id = generate_conn_id();
    let ssml_msg = format!(
        "X-RequestId:{req_id}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'><voice name='{voice_name}'><prosody pitch='{pitch}' rate='+0%' volume='+0%'>{escaped_text}</prosody></voice></speak>"
    );
    ws_stream.send(Message::Text(ssml_msg.into())).await.ok()?;

    let mut audio_chunks = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(4000);

    while let Ok(Some(msg_res)) = tokio::time::timeout_at(deadline, ws_stream.next()).await {
        match msg_res {
            Ok(Message::Binary(bin)) => {
                if bin.len() > 2 {
                    let header_len = u16::from_be_bytes([bin[0], bin[1]]) as usize;
                    if bin.len() >= 2 + header_len {
                        let audio_data = &bin[2 + header_len..];
                        if !audio_data.is_empty() {
                            audio_chunks.extend_from_slice(audio_data);
                        }
                    }
                }
            }
            Ok(Message::Text(txt)) => {
                if txt.contains("Path:turn.end") {
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => {}
        }
    }

    if audio_chunks.len() > 200 {
        Some(audio_chunks)
    } else {
        None
    }
}

pub async fn synthesize_tts_bytes(state: &AppState, text: &str, voice: Option<&str>) -> Option<Vec<u8>> {
    let cleaned = get_re_ws().replace_all(text.trim(), " ").to_string();
    if cleaned.is_empty() {
        return None;
    }

    let target_text = if crate::state::get_re_vi().is_match(&cleaned) {
        cleaned
    } else {
        state.ocr.restore_vietnamese(&cleaned)
    };

    let selected_voice = voice.unwrap_or("vieneu:Trúc Ly");
    let cache_key = format!("tts:{}:{}", selected_voice, target_text);

    // 1. Check in-memory audio cache
    if let Ok(c) = state.audio_cache.read() {
        if let Some(audio_bytes) = c.get(&cache_key) {
            return Some(audio_bytes.clone());
        }
    }

    // 2. If voice is NOT google-vi, try Microsoft Edge Neural TTS first
    if selected_voice != "google-vi" {
        if let Some(edge_audio) = synthesize_edge_tts(selected_voice, &target_text).await {
            if let Ok(mut c) = state.audio_cache.write() {
                if c.len() < 4096 {
                    c.insert(cache_key, edge_audio.clone());
                }
            }
            return Some(edge_audio);
        }
    }

    // 3. Fallback to Google TTS endpoint
    let url = format!(
        "https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q={}",
        urlencoding::encode(&target_text)
    );

    if let Ok(resp) = state.http_client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(bytes) = resp.bytes().await {
                if bytes.len() > 100 {
                    let audio_vec = bytes.to_vec();
                    if let Ok(mut c) = state.audio_cache.write() {
                        if c.len() < 4096 {
                            c.insert(cache_key, audio_vec.clone());
                        }
                    }
                    return Some(audio_vec);
                }
            }
        }
    }

    None
}

pub async fn synthesize_tts(state: &AppState, text: &str, voice: Option<&str>) -> Response {
    if let Some(audio_vec) = synthesize_tts_bytes(state, text, voice).await {
        let mut res = audio_vec.into_response();
        res.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        );
        res
    } else {
        (
            StatusCode::BAD_GATEWAY,
            "No real TTS provider produced audio",
        )
            .into_response()
    }
}

