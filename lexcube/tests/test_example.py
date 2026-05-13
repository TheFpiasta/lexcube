#!/usr/bin/env python
# coding: utf-8


import numpy as np

from ..cube3d import Cube3DWidget


def test_example_creation_blank():
    data = np.random.rand(3, 4, 5).astype('float32')
    w = Cube3DWidget(data)
    metadata = w.api_metadata['/api/datasets/default']

    assert metadata['dims'] == {'Z': 3, 'Y': 4, 'X': 5}
