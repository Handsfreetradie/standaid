import { useEffect, useRef, useState } from "react";
import { Loader2, X, Camera as CameraIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (blob: Blob) => void;
  capturing?: boolean;
}

export default function CameraCapture({ open, onClose, onCapture, capturing }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  useEffect(() => {
    if (!open) return;

    const startCamera = async () => {
      try {
        setError(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not access camera. Please check permissions."
        );
      }
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [open, facingMode]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const video = videoRef.current;
    canvasRef.current.width = video.videoWidth;
    canvasRef.current.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    canvasRef.current.toBlob((blob) => {
      if (blob) {
        canvasRef.current?.toDataURL("image/jpeg", (url) => {
          setCapturedImage(url);
        });
      }
    }, "image/jpeg", 0.9);
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  const handleConfirm = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(
      (blob) => {
        if (blob) {
          onCapture(blob);
          setCapturedImage(null);
          setStream(null);
          onClose();
        }
      },
      "image/jpeg",
      0.9
    );
  };

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Take a photo</DialogTitle>
        </DialogHeader>

        {error ? (
          <div className="text-center py-8">
            <p className="text-sm text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : capturedImage ? (
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center">
              <img src={capturedImage} alt="Captured" className="w-full h-full object-contain" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRetake} className="flex-1">
                <RotateCcw className="h-4 w-4 mr-2" /> Retake
              </Button>
              <Button onClick={handleConfirm} disabled={capturing} className="flex-1">
                {capturing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CameraIcon className="h-4 w-4 mr-2" />}
                {capturing ? "Saving..." : "Confirm"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden bg-black flex items-center justify-center aspect-[4/3]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={toggleCamera} className="flex-1">
                {facingMode === "environment" ? "Self" : "Back"}
              </Button>
              <Button onClick={handleCapture} className="flex-1">
                <CameraIcon className="h-4 w-4 mr-2" /> Capture
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
      <canvas ref={canvasRef} className="hidden" />
    </Dialog>
  );
}
