type TrainVisualProps = {
  className?: string
}

export default function TrainVisual({ className = '' }: TrainVisualProps) {
  return (
    <div className={`railsync-train-visual ${className}`}>
      <img
        src="/railsync-train.png"
        alt="RailSync AI high-speed electric train"
        className="railsync-train-image"
      />

      <style>{`
        .railsync-train-visual.hero-train {
          position: absolute !important;
          right: -2% !important;
          bottom: -12px !important;

          width: 74% !important;
          height: 300px !important;

          display: flex !important;
          align-items: flex-end !important;
          justify-content: flex-end !important;

          z-index: 4 !important;
          pointer-events: none !important;

          overflow: visible !important;
        }

        .railsync-train-image {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: right bottom;

          filter:
            drop-shadow(0 18px 25px rgba(0, 0, 0, 0.32))
            drop-shadow(0 0 18px rgba(0, 190, 255, 0.10));

          user-select: none;
        }

        @media (min-width: 1500px) {
          .railsync-train-visual.hero-train {
            width: 75% !important;
            height: 325px !important;
            right: -1% !important;
            bottom: -10px !important;
          }
        }

        @media (max-width: 1200px) {
          .railsync-train-visual.hero-train {
            width: 72% !important;
            height: 285px !important;
            right: -3% !important;
          }
        }

        @media (max-width: 900px) {
          .railsync-train-visual.hero-train {
            width: 76% !important;
            height: 245px !important;
            right: -9% !important;
            bottom: -2px !important;
          }
        }

        @media (max-width: 700px) {
          .railsync-train-visual.hero-train {
            width: 92% !important;
            height: 205px !important;
            right: -20% !important;
            bottom: 0 !important;
            opacity: .72;
          }
        }

        @media (max-width: 520px) {
          .railsync-train-visual.hero-train {
            width: 105% !important;
            height: 175px !important;
            right: -29% !important;
            bottom: 0 !important;
            opacity: .5;
          }
        }
      `}</style>
    </div>
  )
} 