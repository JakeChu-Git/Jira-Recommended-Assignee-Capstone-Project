// To prevent unit tests from hiting real kvs
export const kvs = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn()
};