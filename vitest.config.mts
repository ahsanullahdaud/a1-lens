import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // url-source.ts imports the DB client at module load; tests never query it.
    env: { DATABASE_URL: "postgres://unused:unused@localhost:5432/unused" },
  },
});
