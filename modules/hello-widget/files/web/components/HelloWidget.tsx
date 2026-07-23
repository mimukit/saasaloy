import { greeting } from "../hello.js";

export function HelloWidget({ name }: { name: string }) {
  return (
    <div className="hello-widget">
      {greeting()}, {name}!
    </div>
  );
}
