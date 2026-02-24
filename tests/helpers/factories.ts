import { User, Role } from '../../src/types';

export function makeToken(user: User): string {
  return Buffer.from(JSON.stringify(user)).toString('base64');
}

export function makeAuthHeader(user: User): string {
  return `Bearer ${makeToken(user)}`;
}

export const testUsers = {
  admin: { id: '00000000-0000-0000-0000-000000000001', role: 'admin' as Role },
  doctor1: { id: '00000000-0000-0000-0000-000000000002', role: 'doctor' as Role },
  doctor2: { id: '00000000-0000-0000-0000-000000000003', role: 'doctor' as Role },
  patient1: { id: '00000000-0000-0000-0000-000000000004', role: 'patient' as Role },
  patient2: { id: '00000000-0000-0000-0000-000000000005', role: 'patient' as Role },
};
