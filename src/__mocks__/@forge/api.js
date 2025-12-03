// To prevent unit tests from hiting Jira API
export const route = jest.fn((strings, ...values) => {
  return strings.join('');
});

export const api = {
  asApp: jest.fn(() => ({
    requestJira: jest.fn()
  })),
  asUser: jest.fn(() => ({
    requestJira: jest.fn()
  }))
};

export default api;