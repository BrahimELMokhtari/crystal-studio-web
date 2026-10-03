import copy

import numpy as np
import pytest
from ase import Atoms
from ase.geometry import cellpar_to_cell

import science
from parsers import parse_structure
from science import StructureError, model, parse_repetitions, rebuild


def synthetic_model(atoms):
    return model(atoms, name="Synthetic regression", source={"filename": "synthetic", "format": "model", "description": "Ideal synthetic regression model."})


def test_periodic_bond_preserves_image_shift_and_short_endpoint(simple_cif):
    result = parse_structure(simple_cif, "boundary.cif")
    assert len(result["bonds"]) == 1
    bond = result["bonds"][0]
    assert bond["shift"] == [-1, 0, 0]
    assert bond["distance"] == pytest.approx(0.2)
    assert np.linalg.norm(np.array(bond["end"]) - bond["start"]) == pytest.approx(0.2)
    assert np.linalg.norm(np.array(result["atoms"][1]["position"]) - result["atoms"][0]["position"]) == pytest.approx(9.8)


def test_cif_symmetry_is_expanded(simple_cif):
    data = simple_cif.replace(b"'P 1'", b"'P -1'").replace(b"_space_group_IT_number 1", b"_space_group_IT_number 2")
    data = data.replace(b"'x,y,z'", b"'x,y,z'\n'-x,-y,-z'")
    data = data.replace(b"H1 H 0.01 0.5 0.5 1\nH2 H 0.99 0.5 0.5 1", b"H1 H 0.1 0.2 0.3 1")
    result = parse_structure(data, "inversion.cif")
    assert len(result["atoms"]) == 2
    np.testing.assert_allclose(result["atoms"][0]["fractional"], [0.1, 0.2, 0.3])
    np.testing.assert_allclose(result["atoms"][1]["fractional"], [0.9, 0.8, 0.7])


def test_skew_cell_vectors_and_cartesian_coordinates(simple_cif):
    data = (simple_cif.replace(b"_cell_length_a 10", b"_cell_length_a 4")
            .replace(b"_cell_length_b 10", b"_cell_length_b 5")
            .replace(b"_cell_length_c 10", b"_cell_length_c 6")
            .replace(b"_cell_angle_alpha 90", b"_cell_angle_alpha 80")
            .replace(b"_cell_angle_beta 90", b"_cell_angle_beta 75")
            .replace(b"_cell_angle_gamma 90", b"_cell_angle_gamma 120"))
    result = parse_structure(data, "skew.cif")
    cell = cellpar_to_cell([4, 5, 6, 80, 75, 120])
    np.testing.assert_allclose(result["cell"]["vectors"], cell)
    for atom in result["atoms"]:
        np.testing.assert_allclose(atom["position"], np.array(atom["fractional"]) @ cell)
    for bond in result["bonds"]:
        right = result["atoms"][bond["j"]]["position"]
        np.testing.assert_allclose(bond["end"], np.array(right) + np.array(bond["shift"]) @ cell)


def test_partial_occupancy_and_reconstruction_metadata(simple_cif):
    data = simple_cif.replace(b"H1 H 0.01 0.5 0.5 1", b"H1 H 0.01 0.5 0.5 0.5")
    data = data.replace(b"data_synthetic", b"data_synthetic\n_audit_creation_method 'Approximate reconstruction from an image'")
    result = parse_structure(data, "reconstruction.cif")
    assert result["atoms"][0]["occupancy"] == pytest.approx(0.5)
    assert "Approximate reconstruction" in result["source"]["metadata"]["auditCreationMethod"]
    assert any("not a validated experimental" in warning for warning in result["warnings"])
    assert any("not occupancy-weighted" in warning for warning in result["warnings"])
    assert rebuild(result)["source"]["metadata"] == result["source"]["metadata"]


def test_mixed_site_is_explicitly_warned(simple_cif):
    data = simple_cif.replace(b"H1 H 0.01 0.5 0.5 1\nH2 H 0.99 0.5 0.5 1", b"Fe1 Fe 0.1 0.2 0.3 0.4\nNi1 Ni 0.1 0.2 0.3 0.6")
    result = parse_structure(data, "disorder.cif")
    assert any("Mixed-element" in warning for warning in result["warnings"])
    assert all(atom["element"] == "Ni" for atom in result["atoms"])
    assert all(atom["occupancy"] == pytest.approx(0.6) for atom in result["atoms"])


def test_zero_occupancy_sites_are_omitted(simple_cif):
    result = parse_structure(simple_cif.replace(b"H1 H 0.01 0.5 0.5 1", b"H1 H 0.01 0.5 0.5 0"), "vacancy.cif")
    assert len(result["atoms"]) == 1
    assert result["atoms"][0]["id"] == 0
    assert all(atom["occupancy"] > 0 for atom in result["atoms"])
    assert any("vacant" in warning for warning in result["warnings"])


def test_vesta_explicit_symmetry_expands_and_deduplicates(simple_vesta):
    result = parse_structure(simple_vesta, "inversion.vesta")
    assert len(result["atoms"]) == 2
    np.testing.assert_allclose(result["atoms"][1]["fractional"], [0.9, 0.8, 0.7])
    special = simple_vesta.replace(b"0.1 0.2 0.3", b"0 0 0")
    assert len(parse_structure(special, "special.vesta")["atoms"]) == 1


def test_vesta_nonidentity_transform_is_rejected(simple_vesta):
    data = simple_vesta.replace(b"TRANM 0\n0 0 0 1 0 0 0 1 0 0 0 1", b"TRANM 0\n0.5 0 0 1 0 0 0 1 0 0 0 1")
    with pytest.raises(StructureError, match="transformations"):
        parse_structure(data, "transformed.vesta")


def test_vesta_missing_non_p1_symmetry_is_rejected(simple_vesta):
    data = simple_vesta.replace(b"SYMOP\n0 0 0 1 0 0 0 1 0 0 0 1 1\n0 0 0 -1 0 0 0 -1 0 0 0 -1 1\n-1 -1 -1 0 0 0 0 0 0 0 0 0\n", b"")
    with pytest.raises(StructureError, match="explicit SYMOP"):
        parse_structure(data, "missing.vesta")


@pytest.mark.parametrize("data,name", [(b"bad", "bad.cif"), (b"CELLP\n10 10 10 90 90 90\nSTRUC\ninvalid", "bad.vesta"), (b"", "empty.cif")])
def test_malformed_files_are_rejected(data, name):
    with pytest.raises(StructureError):
        parse_structure(data, name)


def test_file_size_and_format_bounds(simple_cif):
    with pytest.raises(StructureError, match="2 MiB"):
        parse_structure(b"x" * (science.MAX_FILE_BYTES + 1), "large.cif")
    with pytest.raises(StructureError, match="Supported file formats"):
        parse_structure(simple_cif, "structure.xyz")


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True, "1.1", 0.49, 2.01])
def test_invalid_bond_scale_is_rejected(value):
    with pytest.raises(StructureError):
        synthetic_model_with_scale = model(Atoms("H", cell=[10, 10, 10], pbc=True), name="test", source={}, scale=value)


@pytest.mark.parametrize("repeat", [[0, 1, 1], [6, 1, 1], [True, 1, 1], [1.5, 1, 1], [1, 1]])
def test_invalid_repetitions_are_rejected(repeat):
    with pytest.raises(StructureError):
        model(Atoms("H", cell=[10, 10, 10], pbc=True), name="test", source={}, repeat=repeat)


def test_atom_and_supercell_bounds():
    with pytest.raises(StructureError, match="2000 atoms"):
        synthetic_model(Atoms("H" * 2001, cell=[10, 10, 10], pbc=True))
    with pytest.raises(StructureError, match="2000 atoms"):
        model(Atoms("H" * 20, cell=[10, 10, 10], pbc=True), name="test", source={}, repeat=[5, 5, 5])


def test_bond_output_bound_is_enforced():
    atoms = Atoms("H" * 202, positions=[[0.001 * index, 0, 0] for index in range(202)], cell=[10, 10, 10], pbc=True)
    with pytest.raises(StructureError, match="20000 bonds"):
        synthetic_model(atoms)


def test_periodic_image_memory_bound_is_enforced():
    atoms = Atoms("Cs" * 4, cell=[0.5, 0.5, 0.5], pbc=True)
    with pytest.raises(StructureError, match="too many periodic images"):
        model(atoms, name="test", source={}, scale=2)


def test_rebuild_recomputes_instead_of_trusting_bonds_and_positions(simple_cif):
    unit = parse_structure(simple_cif, "boundary.cif")
    unit["atoms"][0]["position"] = [999, 999, 999]
    unit["bonds"] = [{"distance": -1}]
    result = rebuild(unit, 1.1, [2, 1, 1])
    assert len(result["atoms"]) == 4
    assert result["cell"]["lengths"] == pytest.approx([20, 10, 10])
    assert len(result["bonds"]) == 2
    assert all(bond["distance"] == pytest.approx(0.2) for bond in result["bonds"])
    with pytest.raises(StructureError, match="original unit-cell"):
        rebuild(result, 1.1, [2, 1, 1])
    assert len(rebuild(unit, 1.1, [3, 1, 1])["atoms"]) == 6


@pytest.mark.parametrize("mutation", ["element", "fractional", "cell", "occupancy", "schema"])
def test_rebuild_rejects_invalid_client_model(simple_cif, mutation):
    result = copy.deepcopy(parse_structure(simple_cif, "boundary.cif"))
    if mutation == "element":
        result["atoms"][0]["element"] = []
    elif mutation == "fractional":
        result["atoms"][0]["fractional"][0] = float("nan")
    elif mutation == "cell":
        result["cell"]["vectors"] = [["1", 0, 0], [0, 10, 0], [0, 0, 10]]
    elif mutation == "occupancy":
        result["atoms"][0]["occupancy"] = 1.2
    else:
        result["schemaVersion"] = True
    with pytest.raises(StructureError):
        rebuild(result)


def test_supercell_string_requires_integer_triplet():
    assert parse_repetitions("2, 3,1") == (2, 3, 1)
    for text in ("1.0,1,1", "1,1", "1,1,6", "nan,1,1", "1;1;1"):
        with pytest.raises(StructureError):
            parse_repetitions(text)


@pytest.mark.parametrize("symbol", ["Bk", "Lr", "Rf", "Ds", "Og"])
def test_late_elements_have_explicit_bounded_radius_and_palette_fallbacks(symbol):
    atoms = Atoms(symbols=[symbol], scaled_positions=[[0.1, 0.2, 0.3]],
                  cell=[10, 10, 10], pbc=True)
    result = synthetic_model(atoms)
    entry = result["atoms"][0]
    assert entry["covalentRadius"] == 2
    assert entry["vdwRadius"] == 3
    assert any("not a measured radius" in warning for warning in result["warnings"])
    assert any("1.5 times" in warning for warning in result["warnings"])
    assert result["elements"][0]["color"].startswith("#")
    if symbol in ("Ds", "Og"):
        assert result["elements"][0]["color"] == "#909090"
        assert any("neutral gray" in warning for warning in result["warnings"])
    rebuilt = rebuild(result)
    assert rebuilt["atoms"][0]["element"] == symbol
    assert rebuilt["contactsCalculated"] is True


def test_rebuild_all_118_elements_and_remove_stale_manual_contact_warning():
    from ase.data import chemical_symbols

    atoms = Atoms(symbols=chemical_symbols[1:],
                  scaled_positions=[[i / 118, 0.2, 0.3] for i in range(118)],
                  cell=[1000, 10, 10], pbc=True)
    result = synthetic_model(atoms)
    assert len(result["atoms"]) == len(result["elements"]) == 118
    result["source"]["format"] = "manual"
    result["warnings"].append("Automatic contacts have not been calculated for this manual structure. Use Calculate contacts to calculate periodic contacts with the Python service.")
    result["contactsCalculated"] = False
    rebuilt = rebuild(result)
    assert len(rebuilt["atoms"]) == 118
    assert rebuilt["contactsCalculated"] is True
    assert not any("Automatic contacts have not been calculated" in warning for warning in rebuilt["warnings"])
