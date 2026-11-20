import pytest

from scripts.verify_local_database_recovery import assert_safe_database_name, parse_test_database_url


def test_parse_test_database_url_accepts_isolated_local_database() -> None:
    target = parse_test_database_url("postgresql+asyncpg://tester:secret@localhost:5433/guizhouzhongying_recovery_test")

    assert target.hostname == "localhost"
    assert target.port == 5433
    assert target.username == "tester"
    assert target.database == "guizhouzhongying_recovery_test"
    assert target.url_for("guizhouzhongying_restore_test").endswith("/guizhouzhongying_restore_test")


@pytest.mark.parametrize(
    "url",
    [
        None,
        "postgresql://tester:secret@localhost/guizhouzhongying_test",
        "postgresql+asyncpg://tester:secret@database.example.com/guizhouzhongying_test",
        "postgresql+asyncpg://tester@localhost/guizhouzhongying_test",
        "postgresql+asyncpg://tester:secret@localhost/guizhouzhongying_dev",
    ],
)
def test_parse_test_database_url_rejects_unsafe_targets(url: str | None) -> None:
    with pytest.raises(ValueError):
        parse_test_database_url(url)


@pytest.mark.parametrize("name", ["guizhouzhongying_test", "a1_test", "recovery_case_test"])
def test_safe_database_names_are_accepted(name: str) -> None:
    assert_safe_database_name(name, "database")


@pytest.mark.parametrize(
    "name",
    ["guizhouzhongying_dev", "_test", "Guizhouzhongying_test", "guizhouzhongying-test", "1guizhouzhongying_test"],
)
def test_unsafe_database_names_are_rejected(name: str) -> None:
    with pytest.raises(ValueError):
        assert_safe_database_name(name, "database")
