use std::fmt;

#[derive(Debug)]
pub enum VieneuError {
    Ort(String),
    Tokenizer(String),
    Io(std::io::Error),
    VoiceNotFound(String),
    InvalidTensor(String),
    EmptyAudio,
    Wav(hound::Error),
    Phonemize(String),
    Json(serde_json::Error),
}

impl fmt::Display for VieneuError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VieneuError::Ort(e) => write!(f, "ONNX Runtime error: {}", e),
            VieneuError::Tokenizer(e) => write!(f, "Tokenizer error: {}", e),
            VieneuError::Io(e) => write!(f, "I/O error: {}", e),
            VieneuError::VoiceNotFound(v) => write!(f, "Voice preset not found: '{}'", v),
            VieneuError::InvalidTensor(e) => write!(f, "Invalid tensor: {}", e),
            VieneuError::EmptyAudio => write!(f, "Audio synthesis produced 0 frames"),
            VieneuError::Wav(e) => write!(f, "WAV encoding error: {}", e),
            VieneuError::Phonemize(e) => write!(f, "Phonemization error: {}", e),
            VieneuError::Json(e) => write!(f, "JSON error: {}", e),
        }
    }
}

impl std::error::Error for VieneuError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            VieneuError::Io(e) => Some(e),
            VieneuError::Wav(e) => Some(e),
            VieneuError::Json(e) => Some(e),
            _ => None,
        }
    }
}

impl<R> From<ort::Error<R>> for VieneuError {
    fn from(e: ort::Error<R>) -> Self {
        VieneuError::Ort(e.to_string())
    }
}

impl From<std::io::Error> for VieneuError {
    fn from(e: std::io::Error) -> Self {
        VieneuError::Io(e)
    }
}

impl From<hound::Error> for VieneuError {
    fn from(e: hound::Error) -> Self {
        VieneuError::Wav(e)
    }
}

impl From<serde_json::Error> for VieneuError {
    fn from(e: serde_json::Error) -> Self {
        VieneuError::Json(e)
    }
}
