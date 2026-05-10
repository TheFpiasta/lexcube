/*
    Lexcube - Interactive 3D Data Cube Visualization
    Copyright (C) 2022 Maximilian Söchting <maximilian.soechting@uni-leipzig.de>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Add any needed widget imports here (or from controls)
// import {} from '@jupyter-widgets/base';

jest.mock('../lexcube-client/src/client/client', () => ({
  CubeClientContext: class MockCubeClientContext {},
}));

import { createTestModel } from './utils';

import { Cube3DModel } from '..';

describe('Lexcube', () => {
  describe('Cube3DModel', () => {
    it('should be createable', () => {
      const model = createTestModel(Cube3DModel);
      expect(model).toBeInstanceOf(Cube3DModel);
      expect(model.get('_model_name')).toEqual('Cube3DModel');
      expect(model.get('_view_name')).toEqual('Cube3DView');
    });

    it('should be createable with explicit widget state', () => {
      const state = { isometric_mode: true, force_float32_for_voxel_mode: true };
      const model = createTestModel(Cube3DModel, state);
      expect(model).toBeInstanceOf(Cube3DModel);
      expect(model.get('isometric_mode')).toEqual(true);
      expect(model.get('force_float32_for_voxel_mode')).toEqual(true);
    });
  });
});
