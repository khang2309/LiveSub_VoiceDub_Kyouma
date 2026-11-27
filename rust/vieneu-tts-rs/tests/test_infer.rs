use vieneu_tts_rs::{VieneuEngine, VieneuEngineConfig, VoiceRegistry};

#[test]
fn test_voice_registry() {
    let registry = VoiceRegistry::from_embedded().expect("Should load embedded voices");
    let voices = registry.list_voices();
    println!("Embedded voices count: {}", voices.len());
    assert!(voices.len() >= 20);

    let (name, truc_ly) = registry.get_voice("Trúc Ly").expect("Should find Trúc Ly");
    assert_eq!(name, "Trúc Ly");
    assert_eq!(truc_ly.speaker_emb.len(), 192);

    let (name, hai_dang) = registry.get_voice("vi-VN-NamMinhNeural").expect("Should map legacy NamMinh to Hải Đăng");
    assert_eq!(name, "Hải Đăng");
    assert_eq!(hai_dang.speaker_emb.len(), 192);
}

#[test]
fn test_phonemizer() {
    let config = VieneuEngineConfig::default();
    if !config.dict_path.exists() {
        eprintln!("Dict path {:?} does not exist, skipping phonemizer test", config.dict_path);
        return;
    }

    let phonemizer = vieneu_tts_rs::phonemizer::VieneuPhonemizer::new(&config.dict_path)
        .expect("Should initialize phonemizer");
    let text = "Xin chào Việt Nam, đây là hệ thống VieNeu TTS thuần Rust!";
    let phones = phonemizer.phonemize(text);
    println!("Phonemized '{}' -> '{}'", text, phones);
    assert!(!phones.is_empty());
}

#[test]
fn test_engine_infer() {
    let config = VieneuEngineConfig::default();
    if !config.onnx_dir.exists() || !config.heads_dir.exists() || !config.dict_path.exists() {
        eprintln!("Model files not present, skipping test_engine_infer");
        return;
    }

    let t0 = std::time::Instant::now();
    println!("Initializing VieneuEngine...");
    let engine = VieneuEngine::new(config).expect("Failed to initialize VieneuEngine");
    println!("Model load & CUDA init time: {:.2}s", t0.elapsed().as_secs_f64());

    let sentences = [
        "Xin chào, tôi là Trúc Ly.",
        "Mỗi năm một nghìn lượng bạc, năm nay tôi trả được một nửa rồi.",
        "Tôi không thể mất tiếp một thành viên nữa trong nhà đâu!",
        "Chúng ta phải cố gắng hơn nữa."
    ];

    for (i, sent) in sentences.iter().enumerate() {
        let t_start = std::time::Instant::now();
        let wav_bytes = engine.infer(sent, "Trúc Ly").expect("Inference failed");
        let elapsed_ms = t_start.elapsed().as_secs_f64() * 1000.0;
        let audio_sec = (wav_bytes.len().saturating_sub(44)) as f64 / (48000.0 * 2.0); // 48kHz, 16-bit mono
        let rtf = (elapsed_ms / 1000.0) / audio_sec.max(0.01);
        println!(
            "[{}] Text: '{}' -> Sinh ra {:.2}s audio trong {:.0}ms (RTF: {:.2}x)",
            i + 1, sent, audio_sec, elapsed_ms, rtf
        );
        assert!(wav_bytes.len() > 1000);
    }
}
