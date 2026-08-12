import { ImageGenerationSettings } from '@/components/settings/ImageGenerationSettings';

export function ImageGenerationPage() {
  return (
    <div
      data-testid="image-generation-page"
      className="openx-page-root"
    >
      <div className="openx-page-frame">
        <ImageGenerationSettings />
      </div>
    </div>
  );
}

export default ImageGenerationPage;
