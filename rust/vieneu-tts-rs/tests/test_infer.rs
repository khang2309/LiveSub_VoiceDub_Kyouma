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
    let dict_path = "C:\\dich\\tools\\sea-g2p\\python\\sea_g2p\\sea_g2p.bin";
    if !std::path::Path::new(dict_path).exists() {
        eprintln!("Dict path does not exist, skipping phonemizer test");
        return;
    }

    let phonemizer = vieneu_tts_rs::phonemizer::VieneuPhonemizer::new(dict_path)
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

    println!("Initializing VieneuEngine...");
    let engine = VieneuEngine::new(config).expect("Failed to initialize VieneuEngine");

    println!("Inferring test audio with Trúc Ly...");
    let wav_bytes = engine.infer("Xin chào, tôi là Trúc Ly.", "Trúc Ly").expect("Inference failed");
    println!("Generated WAV audio: {} bytes", wav_bytes.len());
    assert!(wav_bytes.len() > 1000);

    // Save test output for inspection
    std::fs::write("target/test_truc_ly.wav", &wav_bytes).ok();
}
