import path from "node:path";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:54329/ros_test";
process.env.MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APPROVAL_LINK_SECRET = "test-secret";
process.env.ALLOW_SIMULATED_PROVIDER = "true";
process.env.ARTIFACTS_DIR = path.resolve(__dirname, "../data/test/artifacts");
process.env.APP_URL = "http://localhost:3100";
