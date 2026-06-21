def test_packages_import():
    import etl, models  # noqa: F401
    import pandas, duckdb, statsmodels.api, pydantic  # noqa: F401
