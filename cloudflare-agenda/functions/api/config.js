// Expose la configuration publique nécessaire au front (ID client Google).
import { json } from '../../shared/util.js';

export const onRequestGet = ({ env }) => json({ googleClientId: env.GOOGLE_CLIENT_ID || '' });
