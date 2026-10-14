// EXPERIMENTAL (spec 093): development-time tooling, outside the stable 1.x compatibility promise.
export { createForgeMcpServer, type ForgeMcpOptions } from './server.js';
export { detectProject, type ProjectDetection } from './detect.js';
export { doctorProject, type DoctorCheck, type DoctorReport, type CheckStatus } from './doctor.js';
export { searchDocs, listDocs, type DocHit, type DocEntry } from './docs.js';
export { supportFacts, type SupportFacts } from './support.js';
export { fetchRuntimeMetadata, type RuntimeMetadataResult } from './runtime-metadata.js';
