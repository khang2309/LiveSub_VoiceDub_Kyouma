"""Encode VieNeu output as little-endian PCM16."""
import numpy as np

try:
    from livesub_core_rs import pcm16
except ImportError:
    pcm16 = None


def encode_pcm16(samples):
    array = np.asarray(samples)
    if pcm16 is not None and array.dtype == np.dtype("<f4"):
        return pcm16(array.tobytes())
    if np.issubdtype(array.dtype, np.floating):
        array = np.clip(array, -1.0, 1.0) * 32767
    return array.astype("<i2").tobytes()
