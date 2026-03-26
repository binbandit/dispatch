import { describe, expect, it } from "vitest";

import { inferLanguage } from "./highlighter";

describe("inferLanguage", () => {
  describe("JavaScript/TypeScript", () => {
    it("infers typescript from .ts extension", () => {
      expect(inferLanguage("src/app.ts")).toBe("typescript");
    });

    it("infers tsx from .tsx extension", () => {
      expect(inferLanguage("src/Component.tsx")).toBe("tsx");
    });

    it("infers javascript from .js extension", () => {
      expect(inferLanguage("src/legacy.js")).toBe("javascript");
    });

    it("infers jsx from .jsx extension", () => {
      expect(inferLanguage("src/Component.jsx")).toBe("jsx");
    });
  });

  describe("configuration files", () => {
    it("infers json from .json extension", () => {
      expect(inferLanguage("package.json")).toBe("json");
      expect(inferLanguage("tsconfig.json")).toBe("json");
    });

    it("infers yaml from .yml extension", () => {
      expect(inferLanguage(".github/workflows/ci.yml")).toBe("yaml");
    });

    it("infers yaml from .yaml extension", () => {
      expect(inferLanguage("docker-compose.yaml")).toBe("yaml");
    });

    it("infers toml from .toml extension", () => {
      expect(inferLanguage("Cargo.toml")).toBe("toml");
    });
  });

  describe("web languages", () => {
    it("infers css from .css extension", () => {
      expect(inferLanguage("styles/app.css")).toBe("css");
    });

    it("infers html from .html extension", () => {
      expect(inferLanguage("index.html")).toBe("html");
    });

    it("infers markdown from .md extension", () => {
      expect(inferLanguage("README.md")).toBe("markdown");
    });

    it("infers graphql from .graphql extension", () => {
      expect(inferLanguage("schema.graphql")).toBe("graphql");
    });

    it("infers graphql from .gql extension", () => {
      expect(inferLanguage("query.gql")).toBe("graphql");
    });
  });

  describe("programming languages", () => {
    it("infers python from .py extension", () => {
      expect(inferLanguage("script.py")).toBe("python");
    });

    it("infers go from .go extension", () => {
      expect(inferLanguage("main.go")).toBe("go");
    });

    it("infers rust from .rs extension", () => {
      expect(inferLanguage("main.rs")).toBe("rust");
    });

    it("infers java from .java extension", () => {
      expect(inferLanguage("Main.java")).toBe("java");
    });

    it("infers ruby from .rb extension", () => {
      expect(inferLanguage("script.rb")).toBe("ruby");
    });

    it("infers swift from .swift extension", () => {
      expect(inferLanguage("App.swift")).toBe("swift");
    });

    it("infers kotlin from .kt extension", () => {
      expect(inferLanguage("Main.kt")).toBe("kotlin");
    });

    it("infers c from .c extension", () => {
      expect(inferLanguage("program.c")).toBe("c");
    });

    it("infers cpp from .cpp extension", () => {
      expect(inferLanguage("program.cpp")).toBe("cpp");
    });

    it("infers c from .h extension", () => {
      expect(inferLanguage("header.h")).toBe("c");
    });
  });

  describe("shell scripts", () => {
    it("infers shell from .sh extension", () => {
      expect(inferLanguage("script.sh")).toBe("shell");
    });

    it("infers shell from .bash extension", () => {
      expect(inferLanguage("script.bash")).toBe("shell");
    });

    it("infers shell from .zsh extension", () => {
      expect(inferLanguage("script.zsh")).toBe("shell");
    });
  });

  describe("database", () => {
    it("infers sql from .sql extension", () => {
      expect(inferLanguage("schema.sql")).toBe("sql");
    });
  });

  describe("containerization", () => {
    it("infers dockerfile from .dockerfile extension", () => {
      expect(inferLanguage("app.dockerfile")).toBe("dockerfile");
    });
  });

  describe("fallback behavior", () => {
    it("returns text for unknown extension", () => {
      expect(inferLanguage("file.xyz")).toBe("text");
      expect(inferLanguage("README.unknown")).toBe("text");
    });

    it("returns text for no extension", () => {
      expect(inferLanguage("Makefile")).toBe("text");
      expect(inferLanguage("LICENSE")).toBe("text");
    });

    it("handles empty string", () => {
      expect(inferLanguage("")).toBe("text");
    });

    it("handles paths with dots but no extension", () => {
      expect(inferLanguage("src/my.component/index")).toBe("text");
    });
  });

  describe("case insensitivity", () => {
    it("handles uppercase extensions", () => {
      expect(inferLanguage("FILE.TS")).toBe("typescript");
      expect(inferLanguage("README.MD")).toBe("markdown");
    });

    it("handles mixed case extensions", () => {
      expect(inferLanguage("App.Tsx")).toBe("tsx");
      expect(inferLanguage("script.Py")).toBe("python");
    });
  });

  describe("complex paths", () => {
    it("handles deeply nested paths", () => {
      expect(inferLanguage("src/components/ui/button/index.tsx")).toBe("tsx");
    });

    it("handles paths with multiple dots", () => {
      expect(inferLanguage("app.config.ts")).toBe("typescript");
      expect(inferLanguage("schema.generated.graphql")).toBe("graphql");
    });

    it("handles paths with spaces", () => {
      expect(inferLanguage("My File.ts")).toBe("typescript");
    });

    it("extracts extension from filename only", () => {
      expect(inferLanguage("folder.ts/file.js")).toBe("javascript");
    });
  });

  describe("edge cases", () => {
    it("handles single character before extension", () => {
      expect(inferLanguage("a.ts")).toBe("typescript");
    });

    it("handles numeric filenames", () => {
      expect(inferLanguage("123.js")).toBe("javascript");
    });

    it("handles special characters in filename", () => {
      expect(inferLanguage("file-name_with@special.ts")).toBe("typescript");
    });

    it("handles hidden files", () => {
      expect(inferLanguage(".eslintrc.js")).toBe("javascript");
      expect(inferLanguage(".prettierrc.json")).toBe("json");
    });
  });

  describe("real-world file examples", () => {
    it("correctly identifies common config files", () => {
      expect(inferLanguage("tsconfig.json")).toBe("json");
      expect(inferLanguage("package.json")).toBe("json");
      expect(inferLanguage("vite.config.ts")).toBe("typescript");
      expect(inferLanguage("tailwind.config.js")).toBe("javascript");
      expect(inferLanguage(".github/workflows/ci.yml")).toBe("yaml");
    });

    it("correctly identifies React component files", () => {
      expect(inferLanguage("src/components/Button.tsx")).toBe("tsx");
      expect(inferLanguage("src/App.jsx")).toBe("jsx");
    });

    it("correctly identifies test files", () => {
      expect(inferLanguage("app.test.ts")).toBe("typescript");
      expect(inferLanguage("utils.spec.js")).toBe("javascript");
    });

    it("correctly identifies documentation files", () => {
      expect(inferLanguage("README.md")).toBe("markdown");
      expect(inferLanguage("CHANGELOG.md")).toBe("markdown");
      expect(inferLanguage("docs/guide.md")).toBe("markdown");
    });
  });

  describe("performance", () => {
    it("handles large number of inferences quickly", () => {
      const files = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`);

      const start = performance.now();
      for (const file of files) {
        inferLanguage(file);
      }
      const end = performance.now();

      // Should complete 1000 inferences in under 50ms
      expect(end - start).toBeLessThan(50);
    });
  });
});
