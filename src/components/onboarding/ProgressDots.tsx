interface Props {
  total: number;
  current: number;
}

const ProgressDots = ({ total, current }: Props) => (
  <div className="flex items-center justify-center gap-2 py-3">
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={`h-2 rounded-full transition-all duration-300 ${
          i === current ? "w-6 bg-primary" : "w-2 bg-muted"
        }`}
      />
    ))}
  </div>
);

export default ProgressDots;
