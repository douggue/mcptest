// Loaded into a child process by tests that run the command line for real.
// The commands under test must be refused before they connect to anything;
// this makes sure that even a regression could not send a request.
globalThis.fetch = () => Promise.reject(new Error('The network is switched off in tests'));
