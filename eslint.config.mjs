import next from "eslint-config-next";

const config = [
  { ignores: ["src/generated/**", ".next/**", "node_modules/**", "data/**", "artifacts/**", "next-env.d.ts"] },
  ...next,
];
export default config;
