// Time-ordered unique ids: base36 timestamp + random suffix.
// Good enough for thread/message ids without a dependency.
export function ulid(): string {
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, "0");
  return `${time}${rand}`;
}
