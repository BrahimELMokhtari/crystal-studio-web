"""Bounded, browser-independent crystallographic model construction.

Cell vectors are rows. Fractional coordinates multiply those rows, and every
bond retains the integer image shift needed to locate its periodic endpoint.
"""
from __future__ import annotations

import math
from itertools import product
from typing import Any

import numpy as np
from ase import Atoms
from ase.data import atomic_numbers, covalent_radii, vdw_radii
from ase.data.colors import jmol_colors
from scipy.spatial import cKDTree

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ATOMS = 2000
MAX_BONDS = 20000
MAX_IMAGE_ATOMS = 200000
MIN_BOND_SCALE = 0.5
MAX_BOND_SCALE = 2.0
MAX_REPETITION = 5


class StructureError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.number)):
        raise StructureError(f"{label} must be a finite number.")
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise StructureError(f"{label} must be between {minimum:g} and {maximum:g}.")
    return result


def bond_scale(value: Any) -> float:
    return number(value, "Bond scale", MIN_BOND_SCALE, MAX_BOND_SCALE)


def repetitions(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise StructureError("Supercell repetitions must contain three integers.")
    if any(isinstance(item, bool) or not isinstance(item, int)
           or not 1 <= item <= MAX_REPETITION for item in value):
        raise StructureError("Supercell repetitions must be integers from 1 to 5.")
    return tuple(value)


def parse_repetitions(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or len(value) > 30:
        raise StructureError("Supercell must use the format 1,1,1.")
    try:
        parts = value.split(",")
        if len(parts) != 3 or any(not part.strip().isdigit() for part in parts):
            raise ValueError
        return repetitions([int(part.strip()) for part in parts])
    except ValueError as exc:
        raise StructureError("Supercell must contain three integers from 1 to 5.") from exc


def validate_cell(value: Any) -> np.ndarray:
    try:
        original = np.asarray(value)
        if original.dtype.kind not in "iuf":
            raise ValueError("non-numeric cell")
        cell = original.astype(float)
    except (TypeError, ValueError) as exc:
        raise StructureError("Cell vectors must be a finite 3 by 3 matrix.") from exc
    if cell.shape != (3, 3) or not np.isfinite(cell).all():
        raise StructureError("Cell vectors must be a finite 3 by 3 matrix.")
    lengths = np.linalg.norm(cell, axis=1)
    determinant = float(np.linalg.det(cell))
    if np.any(lengths < 0.5) or np.any(lengths > 1000):
        raise StructureError("Cell-vector lengths must be between 0.5 and 1000 angstroms.")
    if determinant < 0.1 or np.linalg.svd(cell, compute_uv=False).min() < 0.2:
        raise StructureError("Cell must be right-handed, non-degenerate, and have volume at least 0.1 cubic angstroms.")
    return cell


def clean_text(value: Any, default: str = "", limit: int = 300) -> str:
    if not isinstance(value, str):
        return default
    return " ".join(value.replace("\x00", "").split())[:limit]


def clean_source(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {
        "filename": clean_text(source.get("filename"), "reconstructed structure", 150),
        "format": clean_text(source.get("format"), "model", 20),
        "description": clean_text(source.get("description"), "Rebuilt from the supplied unit-cell model.", 600),
    }
    metadata = source.get("metadata")
    if isinstance(metadata, dict):
        allowed = ("dataBlock", "chemicalName", "declaredFormula", "spaceGroup", "auditCreationMethod")
        result["metadata"] = {key: clean_text(metadata[key], limit=400)
                              for key in allowed if isinstance(metadata.get(key), str)}
    return result


def clean_warnings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(clean_text(item, limit=500) for item in value[:50]
                              if isinstance(item, str) and item.strip()))


def validate_atoms(atoms: Atoms, occupancies: Any = None) -> np.ndarray:
    if not 1 <= len(atoms) <= MAX_ATOMS:
        raise StructureError(f"Structure must contain between 1 and {MAX_ATOMS} atoms.")
    validate_cell(atoms.cell.array)
    if np.any(atoms.numbers <= 0) or np.any(atoms.numbers >= len(covalent_radii)):
        raise StructureError("Every atom must have a recognized chemical element.")
    frac = atoms.get_scaled_positions(wrap=False)
    if not np.isfinite(frac).all() or np.max(np.abs(frac)) > 100000:
        raise StructureError("Atomic coordinates must be finite and within the supported range.")
    if occupancies is None:
        return np.ones(len(atoms), dtype=float)
    if len(occupancies) != len(atoms):
        raise StructureError("Occupancy values must match the number of atoms.")
    return np.array([number(item, "Occupancy", 0, 1) for item in occupancies])


def periodic_bonds(atoms: Atoms, scale: float) -> list[dict[str, Any]]:
    """Query one atom at a time, bounding image memory and output allocation."""
    cell = atoms.cell.array
    positions = atoms.positions
    radii = covalent_radii[atoms.numbers]
    cutoff = 2 * float(radii.max()) * scale
    inverse = np.linalg.inv(cell)
    heights = 1 / np.linalg.norm(inverse, axis=0)
    extents = np.ceil(cutoff / heights).astype(int)
    image_count = int(np.prod(2 * extents + 1))
    if image_count * len(atoms) > MAX_IMAGE_ATOMS:
        raise StructureError("Cell and bond scale require too many periodic images; use a larger cell or smaller bond scale.")
    shifts = np.array(list(product(*(range(-int(n), int(n) + 1) for n in extents))), dtype=int)
    images = (positions[None, :, :] + (shifts @ cell)[:, None, :]).reshape(-1, 3)
    tree = cKDTree(images)
    seen: set[tuple[int, int, int, int, int]] = set()
    result: list[dict[str, Any]] = []
    for i, start in enumerate(positions):
        for image_index in tree.query_ball_point(start, cutoff + 1e-9):
            image, j = divmod(image_index, len(atoms))
            shift = tuple(int(item) for item in shifts[image])
            if i == j and shift == (0, 0, 0):
                continue
            delta = images[image_index] - start
            distance = float(np.linalg.norm(delta))
            if distance < 1e-7 or distance > (float(radii[i]) + float(radii[j])) * scale + 1e-9:
                continue
            forward = (i, j, *shift)
            reverse = (j, i, *(-item for item in shift))
            key = min(forward, reverse)
            if key in seen:
                continue
            if len(result) >= MAX_BONDS:
                raise StructureError(f"Structure exceeds the limit of {MAX_BONDS} bonds; reduce bond scale or supercell size.")
            seen.add(key)
            left, right, sx, sy, sz = key
            endpoint = positions[right] + np.array([sx, sy, sz]) @ cell
            result.append({"i": left, "j": right, "shift": [sx, sy, sz],
                           "start": positions[left].tolist(), "end": endpoint.tolist(),
                           "distance": distance})
    return sorted(result, key=lambda bond: (bond["i"], bond["j"], *bond["shift"]))


def model(atoms: Atoms, *, name: str, source: dict[str, Any],
          warnings: list[str] | None = None, occupancies: Any = None,
          scale: float = 1.1, repeat: Any = (1, 1, 1)) -> dict[str, Any]:
    scale = bond_scale(scale)
    repeat = repetitions(repeat)
    occupancy = validate_atoms(atoms, occupancies)
    warnings = [warning for warning in clean_warnings(warnings)
                if not warning.startswith("Automatic contacts have not been calculated for this manual structure.")]
    if np.any(occupancy == 0):
        atoms = atoms[occupancy > 0]
        occupancy = occupancy[occupancy > 0]
        warnings.append("Zero-occupancy vacant sites are omitted from the displayed model.")
        if not len(atoms):
            raise StructureError("Structure contains no occupied atomic sites.")
    if len(atoms) * math.prod(repeat) > MAX_ATOMS:
        raise StructureError(f"Expanded supercell exceeds the limit of {MAX_ATOMS} atoms.")
    atoms = atoms.copy()
    atoms.pbc = True
    atoms.set_scaled_positions(np.mod(atoms.get_scaled_positions(wrap=False), 1.0))
    base_count = len(atoms)
    if repeat != (1, 1, 1):
        atoms = atoms.repeat(repeat)
        occupancy = np.tile(occupancy, math.prod(repeat))
    validate_atoms(atoms, occupancy)
    if np.any(occupancy < 1):
        warnings.append("Partial occupancies are shown as representative sites; atom counts and formula are not occupancy-weighted.")
    fractional = atoms.get_scaled_positions(wrap=False)
    bonds = periodic_bonds(atoms, scale)
    entries = []
    for index, (symbol, position, frac, number_, occ) in enumerate(zip(
            atoms.get_chemical_symbols(), atoms.positions, fractional, atoms.numbers, occupancy)):
        radius = float(vdw_radii[number_]) if number_ < len(vdw_radii) else math.nan
        if not math.isfinite(radius) or radius <= 0:
            radius = float(covalent_radii[number_]) * 1.5
            warning = "Some elements lack tabulated van der Waals radii; their space-filling radii use 1.5 times the covalent radius."
            if warning not in warnings:
                warnings.append(warning)
        entries.append({"id": index, "element": symbol, "fractional": frac.tolist(),
                        "position": position.tolist(), "covalentRadius": float(covalent_radii[number_]),
                        "vdwRadius": radius, "occupancy": float(occ)})
    elements = []
    for symbol in sorted(set(atoms.get_chemical_symbols()), key=atomic_numbers.get):
        atomic_number = atomic_numbers[symbol]
        if atomic_number >= 97:
            warning = "Elements Bk through Og lack tabulated covalent radii in ASE; a 2 angstrom display default is used and is not a measured radius."
            if warning not in warnings:
                warnings.append(warning)
        if atomic_number < len(jmol_colors):
            rgb = np.rint(jmol_colors[atomic_number] * 255).astype(int)
        else:
            rgb = np.array([144, 144, 144])
            warning = "Elements Ds through Og lack a bundled Jmol color and use neutral gray."
            if warning not in warnings:
                warnings.append(warning)
        elements.append({"symbol": symbol, "count": atoms.get_chemical_symbols().count(symbol),
                         "color": "#" + "".join(f"{channel:02x}" for channel in rgb)})
    return {
        "schemaVersion": 1, "name": clean_text(name, "Crystal structure", 150),
        "formula": atoms.get_chemical_formula(mode="hill"),
        "cell": {"vectors": atoms.cell.array.tolist(), "lengths": atoms.cell.lengths().tolist(),
                 "angles": atoms.cell.angles().tolist(), "volume": float(atoms.get_volume()), "periodic": True},
        "atoms": entries, "bonds": bonds, "elements": elements,
        "source": clean_source(source), "warnings": list(dict.fromkeys(warnings)),
        "repetitions": list(repeat), "baseAtomCount": base_count, "bondScale": scale,
        "contactsCalculated": True,
    }


def rebuild(structure: Any, scale: Any = 1.1, repeat: Any = (1, 1, 1)) -> dict[str, Any]:
    if (not isinstance(structure, dict) or type(structure.get("schemaVersion")) is not int
            or structure.get("schemaVersion") != 1):
        raise StructureError("Supply a schemaVersion 1 unit-cell structure.")
    if structure.get("repetitions", [1, 1, 1]) != [1, 1, 1]:
        raise StructureError("Rebuild requires the original unit-cell model, not an already expanded supercell.")
    cell_data = structure.get("cell")
    if not isinstance(cell_data, dict) or cell_data.get("periodic") is not True:
        raise StructureError("A periodic unit cell is required.")
    cell = validate_cell(cell_data.get("vectors"))
    entries = structure.get("atoms")
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_ATOMS:
        raise StructureError(f"Structure must contain between 1 and {MAX_ATOMS} atoms.")
    symbols, fractional, occupancy = [], [], []
    for entry in entries:
        if (not isinstance(entry, dict) or not isinstance(entry.get("element"), str)
                or entry.get("element") not in atomic_numbers or entry.get("element") == "X"):
            raise StructureError("Every atom must have a recognized chemical element.")
        frac = entry.get("fractional")
        if not isinstance(frac, list) or len(frac) != 3:
            raise StructureError("Each atom needs three fractional coordinates.")
        symbols.append(entry["element"])
        fractional.append([number(item, "Fractional coordinate", -100000, 100000) for item in frac])
        occupancy.append(number(entry.get("occupancy", 1), "Occupancy", 0, 1))
    atoms = Atoms(symbols=symbols, scaled_positions=fractional, cell=cell, pbc=True)
    return model(atoms, name=structure.get("name", "Crystal structure"),
                 source=clean_source(structure.get("source")), warnings=clean_warnings(structure.get("warnings")),
                 occupancies=occupancy, scale=scale, repeat=repeat)
