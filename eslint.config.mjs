import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  { ignores: [".next/**", "node_modules/**", "supabase/.temp/**"] },
  ...next,
  ...coreWebVitals,
];
