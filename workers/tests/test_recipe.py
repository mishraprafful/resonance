from resonance_workers.main import derive, recipe_key


def test_recipe_key_is_deterministic_and_content_addressed():
    sha = "a" * 64
    assert recipe_key(sha, "peaks.json") == f"derived/{sha}/peaks.json"


def test_derive_returns_all_three_renditions():
    d = derive("b" * 64)
    assert d.peaks_key.endswith("peaks.json")
    assert d.spectrogram_key.endswith("melspec.png")
    assert d.rendition_key.endswith("stream.opus")
