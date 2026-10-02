import pytest


@pytest.fixture
def simple_cif():
    return b"""data_synthetic
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
_space_group_IT_number 1
loop_
_space_group_symop_operation_xyz
'x,y,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
H1 H 0.01 0.5 0.5 1
H2 H 0.99 0.5 0.5 1
"""


@pytest.fixture
def simple_vesta():
    return b"""#VESTA_FORMAT_VERSION 3.5.4
CRYSTAL
TITLE
Synthetic inversion example
GROUP
2 1 P -1
SYMOP
0 0 0 1 0 0 0 1 0 0 0 1 1
0 0 0 -1 0 0 0 -1 0 0 0 -1 1
-1 -1 -1 0 0 0 0 0 0 0 0 0
TRANM 0
0 0 0 1 0 0 0 1 0 0 0 1
CELLP
10 10 10 90 90 90
STRUC
1 H H1 1 0.1 0.2 0.3 2i 1
0 0 0 0
0 0 0 0 0 0 0
"""
