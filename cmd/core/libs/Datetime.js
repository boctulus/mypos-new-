import { Timestamp } from 'firebase-admin/firestore';

export class Datetime {
    /**
     * Convierte una cadena de fecha en formato ISO 8601 a un objeto Timestamp de Firebase.
     * @param {string} isoString - La fecha en formato ISO 8601 (ej. "2025-05-21T02:28:40.253Z").
     * @returns {Timestamp} Un objeto Timestamp de Firebase.
     */
    isoToFirebaseTimestamp(isoString) {
        // 1. Convierte la cadena ISO a un objeto Date de JavaScript.
        const date = new Date(isoString);
        
        // 2. Utiliza el método estático fromDate() para crear el Timestamp de Firebase.
        return Timestamp.fromDate(date);
    }
}