import copy

import pytest
from fastapi.testclient import TestClient

import app as api
from parsers import parse_structure
from science import MAX_FILE_BYTES


@pytest.fixture
def client():
    with TestClient(api.app) as instance:
        yield instance


def upload(client, data, filename="synthetic.cif", **fields):
    return client.post("/api/structure", files={"file": (filename, data, "application/octet-stream")}, data=fields)


def test_health_and_upload_are_available_without_authentication(client, simple_cif):
    assert client.get("/health").json() == {"status": "ok", "schemaVersion": 1}
    response = upload(client, simple_cif)
    assert response.status_code == 200
    result = response.json()
    assert result["schemaVersion"] == 1
    assert result["source"]["filename"] == "synthetic.cif"
    assert len(result["atoms"]) == 2
    assert result["bonds"][0]["distance"] == pytest.approx(0.2)


def test_upload_supercell_and_source_basename(client, simple_cif):
    response = upload(client, simple_cif, filename=r"C:\private\boundary.cif", bond_scale="1.1", supercell="2,1,1")
    assert response.status_code == 200
    assert response.json()["source"]["filename"] == "boundary.cif"
    assert response.json()["repetitions"] == [2, 1, 1]
    assert len(response.json()["atoms"]) == 4


@pytest.mark.parametrize("fields", [{"bond_scale": "nan"}, {"bond_scale": "inf"}, {"bond_scale": "0.49"},
                                    {"bond_scale": "2.01"}, {"supercell": "6,1,1"}, {"supercell": "1.1,1,1"}])
def test_upload_rejects_invalid_numeric_parameters(client, simple_cif, fields):
    assert upload(client, simple_cif, **fields).status_code == 422


def test_bad_formats_malformed_and_empty_files_have_clear_errors(client):
    assert upload(client, b"not a structure", filename="input.xyz").status_code == 415
    malformed = upload(client, b"not a structure", filename="input.cif")
    assert malformed.status_code == 422
    assert "CIF" in malformed.json()["detail"]
    assert upload(client, b"").status_code == 400
    assert client.post("/api/structure", data={}).status_code == 422


def test_file_size_limit_is_enforced(client):
    response = upload(client, b"x" * (MAX_FILE_BYTES + 1))
    assert response.status_code == 413
    assert "2 MiB" in response.json()["detail"]


def test_streamed_request_limit_does_not_depend_on_content_length(client):
    chunks = (b"x" * 4096 for _ in range(api.MAX_MULTIPART_BODY // 4096 + 1))
    response = client.post("/api/structure", content=chunks, headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 413


def test_declared_request_limit_has_cors_headers(client):
    response = client.post("/api/rebuild", content=b"{}", headers={
        "Content-Length": str(api.MAX_REBUILD_BODY + 1), "Content-Type": "application/json",
        "Origin": "http://localhost:5173"})
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_rebuild_recomputes_from_unit_cell(client, simple_cif):
    unit = parse_structure(simple_cif, "synthetic.cif")
    unit["bonds"] = [{"distance": -999}]
    response = client.post("/api/rebuild", json={"structure": unit, "bondScale": 1.1, "repetitions": [3, 1, 1]})
    assert response.status_code == 200
    assert len(response.json()["atoms"]) == 6
    assert response.json()["cell"]["lengths"] == pytest.approx([30, 10, 10])
    assert all(bond["distance"] == pytest.approx(0.2) for bond in response.json()["bonds"])
    repeated = client.post("/api/rebuild", json={"structure": response.json(), "bondScale": 1.1, "repetitions": [2, 1, 1]})
    assert repeated.status_code == 422
    assert "unit-cell" in repeated.json()["detail"]


@pytest.mark.parametrize("changes", [{"bondScale": True}, {"bondScale": "1.1"}, {"bondScale": 5},
                                     {"repetitions": [True, 1, 1]}, {"repetitions": [1.5, 1, 1]},
                                     {"repetitions": [1, 1]}, {"unexpected": "input"}])
def test_json_rebuild_rejects_invalid_parameters(client, simple_cif, changes):
    body = {"structure": parse_structure(simple_cif, "synthetic.cif"), "bondScale": 1.1, "repetitions": [1, 1, 1]}
    body.update(changes)
    assert client.post("/api/rebuild", json=body).status_code == 422


def test_bad_client_structure_returns_validation_error(client, simple_cif):
    unit = copy.deepcopy(parse_structure(simple_cif, "synthetic.cif"))
    unit["atoms"][0]["element"] = []
    response = client.post("/api/rebuild", json={"structure": unit})
    assert response.status_code == 422
    assert "recognized chemical element" in response.json()["detail"]


def test_cors_allows_exact_preview_origins_and_rejects_others(client):
    good = client.options("/api/structure", headers={"Origin": "http://127.0.0.1:5174",
        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert good.status_code == 200
    assert good.headers["access-control-allow-origin"] == "http://127.0.0.1:5174"
    assert "access-control-allow-credentials" not in good.headers
    bad = client.options("/api/structure", headers={"Origin": "https://untrusted.example",
        "Access-Control-Request-Method": "POST"})
    assert bad.status_code == 400
    assert "access-control-allow-origin" not in bad.headers
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": "http://localhost:5173.evil.example"}).headers


def test_custom_origin_configuration_is_exact(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example.github.io/,https://crystal.example")
    assert "https://example.github.io" in api.allowed_origins()
    for value in ("*", "https://example.github.io/repo", "https://*.example", "https://user:password@example.com"):
        monkeypatch.setenv("ALLOWED_ORIGINS", value)
        with pytest.raises(RuntimeError):
            api.allowed_origins()


def test_busy_computation_returns_retryable_status(client, simple_cif, monkeypatch):
    class Busy:
        def locked(self):
            return True
    monkeypatch.setattr(api.app.state, "compute_lock", Busy())
    response = upload(client, simple_cif)
    assert response.status_code == 429
    assert "retry" in response.json()["detail"]


def test_unexpected_processing_failure_returns_safe_server_error(client, simple_cif, monkeypatch):
    def fail(*args):
        raise RuntimeError("Private input text must not be exposed")
    monkeypatch.setattr(api, "parse_structure", fail)
    response = upload(client, simple_cif)
    assert response.status_code == 500
    assert "Private" not in response.text
