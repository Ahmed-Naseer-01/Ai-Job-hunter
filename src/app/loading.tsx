export default function Loading() {
  return <div aria-busy="true" aria-label="Loading"><div className="skeleton" style={{ width: "30%", height: 28 }} /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" style={{ width: "70%" }} /></div>;
}
