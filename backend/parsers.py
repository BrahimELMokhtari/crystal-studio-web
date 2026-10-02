"""Read periodic CIF and the explicitly supported geometric VESTA subset."""
from __future__ import annotations

import io
import re
import warnings as python_warnings
from typing import Any

import numpy as np
from ase import Atoms
from ase.data import atomic_numbers
from ase.geometry import cellpar_to_cell
from ase.io.cif import parse_cif

from science import (MAX_ATOMS, MAX_FILE_BYTES, StructureError, clean_text,
                     model, number, validate_atoms, validate_cell)

MAX_SYMMETRY_CANDIDATES = 20000


def filename_only(value: str) -> str:
    return clean_text(value.replace("\\", "/").rsplit("/", 1)[-1], "structure.cif", 150)


def _cif_text(block: Any, *keys: str) -> str:
    for key in keys:
        value = block.get(key)
        if isinstance(value, (str, int, float)):
            return clean_text(str(value), limit=400)
    return ""


def parse_cif_structure(data: bytes, filename: str) -> tuple[Atoms, np.ndarray, dict, list[str], str]:
    notes: list[str] = []
    with python_warnings.catch_warnings(record=True) as emitted:
        python_warnings.simplefilter("always")
        try:
            blocks = list(parse_cif(io.BytesIO(data)))
            structural = [block for block in blocks if block.has_structure()]
            if not structural:
                raise StructureError("CIF contains no readable atomic structure.")
            block = structural[0]
            cell = validate_cell(block.get_cell().array)
            raw = block.get_unsymmetrized_structure()
            validate_atoms(raw)
            occupancies = block.get("_atom_site_occupancy")
            if occupancies is not None:
                if not isinstance(occupancies, (list, tuple)):
                    occupancies = [occupancies]
                for value in occupancies:
                    number(value, "CIF occupancy", 0, 1)
            spacegroup = block.get_spacegroup(subtrans_included=True)
            operations = spacegroup.get_symop()
            if len(raw) * len(operations) > MAX_SYMMETRY_CANDIDATES:
                raise StructureError("CIF symmetry expansion exceeds the supported processing limit.")
            atoms = block.get_atoms(store_tags=True, fractional_occupancies=True)
            if atoms is None or len(atoms) > MAX_ATOMS:
                raise StructureError(f"CIF symmetry expansion exceeds the limit of {MAX_ATOMS} atoms.")
            atoms.set_cell(cell)
            occupancy = np.ones(len(atoms))
            occupancy_data = atoms.info.get("occupancy", {})
            kinds = atoms.arrays.get("spacegroup_kinds")
            if occupancy_data and kinds is not None:
                for index, (kind, symbol) in enumerate(zip(kinds, atoms.get_chemical_symbols())):
                    site = occupancy_data.get(str(kind), {})
                    occupancy[index] = number(site.get(symbol, 1), "CIF occupancy", 0, 1)
                    if len(site) > 1:
                        notes.append("Mixed-element sites are represented by ASE's dominant element; chemical disorder is not explicitly expanded.")
            metadata = {
                "dataBlock": clean_text(block.name, limit=150),
                "chemicalName": _cif_text(block, "_chemical_name_common", "_chemical_name_systematic"),
                "declaredFormula": _cif_text(block, "_chemical_formula_sum", "_chemical_formula_structural"),
                "spaceGroup": _cif_text(block, "_space_group_name_h-m_alt", "_symmetry_space_group_name_h-m") or str(spacegroup.symbol),
                "auditCreationMethod": _cif_text(block, "_audit_creation_method"),
            }
            source = {"filename": filename, "format": "cif", "description":
                      metadata["auditCreationMethod"] or metadata["chemicalName"] or "CIF structure with crystallographic symmetry expanded by ASE.",
                      "metadata": metadata}
            audit = metadata["auditCreationMethod"].lower()
            if any(word in audit for word in ("approxim", "reconstruct", "image", "illustrat")):
                notes.append("The CIF identifies this structure as an approximation or reconstruction; it is not a validated experimental structure.")
            if len(structural) > 1:
                notes.append(f"CIF contains {len(structural)} structural data blocks; only the first ({block.name}) is displayed.")
            name = metadata["chemicalName"] or filename.rsplit(".", 1)[0]
        except StructureError:
            raise
        except Exception as exc:
            raise StructureError("CIF could not be parsed. Check its unit cell, atom sites, occupancies, and symmetry definitions.") from exc
    notes.extend(clean_text(str(warning.message), limit=500) for warning in emitted)
    return atoms, occupancy, source, list(dict.fromkeys(notes)), name


def _sections(text: str) -> tuple[dict[str, list[str]], dict[str, str], int]:
    sections: dict[str, list[str]] = {}
    arguments: dict[str, str] = {}
    current = ""
    crystal_count = 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if re.fullmatch(r"[A-Z][A-Z0-9_]{1,}(?:\s+[-\d.]+)?", line):
            current, _, args = line.partition(" ")
            if current == "CRYSTAL":
                crystal_count += 1
            if current in sections and current in ("CELLP", "STRUC", "SYMOP", "TRANM"):
                raise StructureError("Multiple VESTA structures or geometry sections are not supported.")
            sections.setdefault(current, [])
            arguments[current] = args.strip()
        elif current:
            sections[current].append(line)
    return sections, arguments, crystal_count


def _numeric(line: str, count: int, label: str) -> np.ndarray:
    try:
        values = np.array([float(item) for item in line.split()[:count]], dtype=float)
    except ValueError as exc:
        raise StructureError(f"Malformed VESTA {label} data.") from exc
    if len(values) != count or not np.isfinite(values).all():
        raise StructureError(f"Malformed VESTA {label} data.")
    return values


def _check_transformations(sections: dict, arguments: dict) -> None:
    if "TRANM" in sections:
        if arguments.get("TRANM") not in ("", "0") or not sections["TRANM"]:
            raise StructureError("This VESTA coordinate transformation is not supported; export an untransformed CIF.")
        values = _numeric(sections["TRANM"][0], 12, "TRANM")
        if not np.allclose(values[:3], 0) or not np.allclose(values[3:].reshape(3, 3), np.eye(3)):
            raise StructureError("Non-identity VESTA coordinate transformations are not supported; export an untransformed CIF.")
    if "LMATRIX" in sections:
        rows = sections["LMATRIX"]
        if len(rows) < 4 or not np.allclose(np.array([_numeric(row, 4, "LMATRIX") for row in rows[:4]]), np.eye(4)):
            raise StructureError("VESTA lattice transformations are not supported; export the transformed structure as CIF.")
    if sections.get("LTRANSL"):
        flag = _numeric(sections["LTRANSL"][0], 1, "LTRANSL")[0]
        if flag != -1:
            raise StructureError("Active VESTA lattice translations are not supported; export the structure as CIF.")


def parse_vesta_structure(data: bytes, filename: str) -> tuple[Atoms, np.ndarray, dict, list[str], str]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise StructureError("VESTA text must use UTF-8 encoding.") from exc
    sections, arguments, crystal_count = _sections(text)
    if crystal_count > 1:
        raise StructureError("Multi-phase VESTA files are not supported; export one phase as CIF.")
    if not sections.get("CELLP") or not sections.get("STRUC"):
        raise StructureError("VESTA file must contain CELLP and STRUC sections.")
    _check_transformations(sections, arguments)
    cell_parameters = _numeric(sections["CELLP"][0], 6, "CELLP")
    if np.any(cell_parameters[:3] <= 0) or np.any(cell_parameters[3:] <= 0) or np.any(cell_parameters[3:] >= 180):
        raise StructureError("VESTA cell lengths and angles are invalid.")
    try:
        cell = validate_cell(cellpar_to_cell(cell_parameters))
    except (ValueError, AssertionError) as exc:
        raise StructureError("VESTA cell geometry is invalid.") from exc
    symmetry: list[tuple[np.ndarray, np.ndarray]] = []
    for line in sections.get("SYMOP", []):
        values = _numeric(line, 12, "SYMOP")
        if np.allclose(values[:3], -1) and np.allclose(values[3:], 0):
            break
        rotation = values[3:].reshape(3, 3)
        if (not np.allclose(rotation, np.rint(rotation)) or np.any(np.abs(rotation) > 1)
                or not np.isclose(abs(np.linalg.det(rotation)), 1)):
            raise StructureError("VESTA symmetry rotations must be valid integer crystallographic operations.")
        metric = cell @ cell.T
        if not np.allclose(rotation.T @ metric @ rotation, metric, rtol=0.001, atol=0.0001):
            raise StructureError("VESTA symmetry operations are inconsistent with its cell metric.")
        symmetry.append((rotation, values[:3]))
    if not symmetry:
        group = " ".join(sections.get("GROUP", []))
        if group and (not group.split()[0].isdigit() or int(group.split()[0]) != 1):
            raise StructureError("Non-P1 VESTA structures require explicit SYMOP operations.")
        symmetry = [(np.eye(3), np.zeros(3))]
    if len(symmetry) > 384:
        raise StructureError("VESTA contains too many symmetry operations.")
    sites = []
    expecting_displacement = False
    found_terminator = False
    for line in sections["STRUC"]:
        fields = line.split()
        if expecting_displacement and len(fields) == 4:
            _numeric(line, 4, "atomic displacement")
            expecting_displacement = False
            continue
        if fields and fields[0] == "0":
            found_terminator = True
            break
        if len(fields) < 7 or not fields[0].isdigit() or fields[1] not in atomic_numbers or fields[1] == "X":
            raise StructureError("Malformed VESTA atom site; expected index, element, label, occupancy and x/y/z.")
        values = _numeric(" ".join(fields[3:7]), 4, "STRUC")
        occupancy = number(float(values[0]), "VESTA occupancy", 0, 1)
        if np.max(np.abs(values[1:])) > 100000:
            raise StructureError("VESTA fractional coordinates exceed the supported range.")
        sites.append((fields[1], values[1:], occupancy))
        expecting_displacement = True
        if len(sites) > MAX_ATOMS or len(sites) * len(symmetry) > MAX_SYMMETRY_CANDIDATES:
            raise StructureError("VESTA symmetry expansion exceeds the supported atom limit.")
    if not sites or not found_terminator:
        raise StructureError("VESTA STRUC section is empty or lacks its terminating zero record.")
    notes = ["VESTA atom geometry and explicit symmetry are imported; display settings and anisotropic displacement parameters are not imported."]
    expanded: dict[tuple[float, float, float], tuple[str, np.ndarray, float]] = {}
    for symbol, frac, occupancy in sites:
        for rotation, translation in symmetry:
            transformed = np.mod(rotation @ frac + translation, 1)
            key = tuple(float(item) for item in np.mod(np.round(transformed, 7), 1))
            if key in expanded:
                previous = expanded[key]
                if previous[0] != symbol:
                    notes.append("Mixed-element VESTA sites are represented by the dominant occupancy; chemical disorder is not explicitly expanded.")
                    if occupancy > previous[2]:
                        expanded[key] = (symbol, transformed, occupancy)
                elif not np.isclose(previous[2], occupancy):
                    raise StructureError("Duplicate VESTA sites have inconsistent occupancies.")
            else:
                expanded[key] = (symbol, transformed, occupancy)
                if len(expanded) > MAX_ATOMS:
                    raise StructureError(f"VESTA symmetry expansion exceeds the limit of {MAX_ATOMS} atoms.")
    values = list(expanded.values())
    atoms = Atoms(symbols=[item[0] for item in values], scaled_positions=[item[1] for item in values], cell=cell, pbc=True)
    occupancy = np.array([item[2] for item in values])
    name = clean_text(" ".join(sections.get("TITLE", [])), filename.rsplit(".", 1)[0], 150)
    source = {"filename": filename, "format": "vesta", "description": "VESTA periodic structure with explicit symmetry expanded.",
              "metadata": {"spaceGroup": clean_text(" ".join(sections.get("GROUP", [])), limit=100)}}
    return atoms, occupancy, source, list(dict.fromkeys(notes)), name


def parse_structure(data: bytes, filename: str, scale: float = 1.1,
                    repeat: Any = (1, 1, 1)) -> dict[str, Any]:
    if not data:
        raise StructureError("Upload a non-empty CIF or VESTA file.", 400)
    if len(data) > MAX_FILE_BYTES:
        raise StructureError("File exceeds the 2 MiB upload limit.", 413)
    filename = filename_only(filename)
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension == "cif":
        atoms, occupancy, source, notes, name = parse_cif_structure(data, filename)
    elif extension == "vesta":
        atoms, occupancy, source, notes, name = parse_vesta_structure(data, filename)
    else:
        raise StructureError("Supported file formats are .cif and .vesta.", 415)
    return model(atoms, name=name, source=source, warnings=notes, occupancies=occupancy, scale=scale, repeat=repeat)
