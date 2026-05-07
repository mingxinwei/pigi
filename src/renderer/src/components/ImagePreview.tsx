import Zoom from 'react-medium-image-zoom';
import 'react-medium-image-zoom/dist/styles.css';

interface ImagePreviewProps {
  src: string;
  alt?: string;
}

export default function ImagePreview({ src, alt }: ImagePreviewProps): React.JSX.Element {
  return (
    <div className="mt-2">
      <Zoom>
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full rounded border border-border/40 object-contain"
        />
      </Zoom>
    </div>
  );
}
