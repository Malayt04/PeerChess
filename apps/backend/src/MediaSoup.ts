
import { types, createWorker } from 'mediasoup';

export let worker: types.Worker;
export const routers = new Map<string, types.Router>();

export const startMediasoup = async () => {
  worker = await createWorker({
    logLevel: 'warn',
  });

  worker.on('died', () => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000);
  });
};

export const createRouter = async (roomId: string) => {
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  });

  routers.set(roomId, router);
  return router;
};

export const getRouter = (roomId: string) => {
  return routers.get(roomId);
};
