export default function GqaiIcon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} className="gqai-icon"><use href={`/gqai/icons.svg#${name}`} /></svg>;
}
