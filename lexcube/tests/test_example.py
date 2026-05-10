#!/usr/bin/env python
# coding: utf-8

# Lexcube - Interactive 3D Data Cube Visualization
# Copyright (C) 2022 Maximilian Söchting <maximilian.soechting@uni-leipzig.de>
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.


import numpy as np

from ..cube3d import Cube3DWidget


def test_example_creation_blank():
    data = np.random.rand(3, 4, 5).astype('float32')
    w = Cube3DWidget(data)
    metadata = w.api_metadata['/api/datasets/default']

    assert metadata['dims'] == {'Z': 3, 'Y': 4, 'X': 5}
