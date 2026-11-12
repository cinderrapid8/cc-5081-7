import { useStore } from '../state/store';

export function Notices() {
  const { notices, dismissNotice } = useStore();
  return (
    <div className="notices">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.kind}`} onClick={() => dismissNotice(n.id)}>
          {n.message}
        </div>
      ))}
    </div>
  );
}
