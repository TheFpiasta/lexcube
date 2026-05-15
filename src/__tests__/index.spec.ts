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
