#[tokio::test]
async fn test_youtube_subtitles_extraction() {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap();

    let innertube_payload = serde_json::json!({
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "20.10.38"
            }
        },
        "videoId": "6Zy5VLcEbZc"
    });

    let resp = client
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header("User-Agent", "com.google.android.youtube/20.10.38 (Linux; U; Android 14)")
        .json(&innertube_payload)
        .send()
        .await
        .expect("Failed to connect to YouTube Innertube API");

    assert!(resp.status().is_success());
    let data: serde_json::Value = resp.json().await.expect("Failed to parse JSON");
    let tracks = data
        .get("captions")
        .and_then(|c| c.get("playerCaptionsTracklistRenderer"))
        .and_then(|p| p.get("captionTracks"))
        .and_then(|ct| ct.as_array())
        .expect("No captionTracks found");

    assert!(!tracks.is_empty(), "captionTracks should not be empty");
    println!("Found {} caption tracks for 6Zy5VLcEbZc", tracks.len());

    let en_or_vi = tracks.iter().find(|t| {
        let code = t.get("languageCode").and_then(|c| c.as_str()).unwrap_or("");
        code == "vi" || code == "en"
    }).expect("Should find either vi or en track");

    let base_url = en_or_vi.get("baseUrl").and_then(|u| u.as_str()).unwrap();
    let xml_resp = client
        .get(base_url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)")
        .send()
        .await
        .expect("Failed to download transcript");

    assert!(xml_resp.status().is_success());
    let xml = xml_resp.text().await.unwrap();
    assert!(xml.contains("<timedtext") || xml.contains("<transcript"));
    println!("Successfully downloaded transcript XML ({} bytes)", xml.len());
}
