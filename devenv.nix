{ pkgs, ... }:
{
  # Toolchain only. Vite+ needs Node >= 22.18 (root package.json engines).
  # gitleaks scans staged changes (pre-commit hook) and the full history (CI) for secrets; its
  # rules live in .gitleaks.toml. The git hooks and CI resolve every tool (vp, gitleaks,
  # commitlint) from this shell's PATH, so they run in the same pinned toolchain.
  #
  # postgresql_18 and pgbouncer are the servers of the conformance harness (spec 0001). The tests start their own
  # throwaway instances on free ports; nothing needs `devenv up`.
  #
  # tlaplus (TLC 2.19) and jre8 (the Java 8 runtime that nixpkgs builds it with) run the model of the claim and fence
  # protocol (`bun run model`, spec 0001); they are in the default shell so that `bun run ready` is one command. The Java
  # heap is capped: without a cap the JVM grows to a quarter of the machine's memory, and the machine is shared.
  packages = [
    pkgs.bun
    pkgs.nodejs_24
    pkgs.gitleaks
    pkgs.postgresql_18
    pkgs.pgbouncer
    pkgs.tlaplus
    pkgs.jre8
  ];

  env = {
    JAVA = "${pkgs.jre8}/bin/java";
    JAVA_TOOL_OPTIONS = "-Xmx2g";
  };
}
