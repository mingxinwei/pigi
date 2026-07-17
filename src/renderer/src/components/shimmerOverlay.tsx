/** Absolute overlay that sweeps a highlight across its (relative) parent, used for shimmer text effects */
export default function ShimmerOverlay(): React.JSX.Element {
  return (
    <span
      className="absolute inset-0 animate-[shimmer_2.5s_linear_infinite]"
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, transparent 30%, rgba(255,255,255,0.95) 50%, transparent 70%, transparent 100%)',
        backgroundSize: '200% 100%',
      }}
    />
  );
}
