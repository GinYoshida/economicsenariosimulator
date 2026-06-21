from etl.registry import KNOWN_CONNECTORS, REGISTRY, SourceSpec


def test_keys_match_series_id_and_unique():
    series_ids = [spec.series_id for spec in REGISTRY.values()]
    for key, spec in REGISTRY.items():
        assert key == spec.series_id
    assert len(series_ids) == len(set(series_ids))


def test_connectors_are_known():
    for spec in REGISTRY.values():
        assert spec.connector in KNOWN_CONNECTORS


def test_urls_non_empty_and_http():
    for spec in REGISTRY.values():
        assert spec.url
        assert spec.url.startswith("http")


def test_core_series_present():
    expected = {
        "household.food.real_yoy",
        "cpi.food",
        "cao.cci.attitude",
        "cao.watcher.outlook",
        "fut.cotton",
    }
    assert expected.issubset(set(REGISTRY.keys()))


def test_estat_and_futures_fetch_params():
    for spec in REGISTRY.values():
        if spec.connector == "estat":
            assert spec.fetch.get("search_word")
        if spec.connector == "futures":
            assert spec.fetch.get("ticker")


def test_spec_is_pydantic_model():
    spec = next(iter(REGISTRY.values()))
    assert isinstance(spec, SourceSpec)
