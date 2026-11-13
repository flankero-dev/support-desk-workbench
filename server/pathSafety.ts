import path from "node:path";
// Relative-path containment works on both Windows drives and POSIX roots.
export function isInside(base: string, file: string, paths = path): boolean {
  const part = paths.relative(base, file);
  return (
    part === "" ||
    (part !== ".." &&
      !part.startsWith(".." + paths.sep) &&
      !paths.isAbsolute(part))
  );
}
