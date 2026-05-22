import { Injectable } from '@angular/core';

export interface ApiListResponse<T> {
  data: T[];
  meta: {
    collection: string;
    count: number;
    limit?: number;
    offset?: number;
  };
}

export interface ApiItemResponse<T> {
  data: T;
}

export interface CollectionMeta {
  slug: string;
  name: string;
  description: string;
  fields: string[];
}

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
}

@Injectable({ providedIn: 'root' })
export class CmsApiService {
  private readonly baseUrl = '/api/v1';

  /** Token de auth — se inyecta desde el microservicio externo */
  authToken: string | null = null;

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.authToken) {
      headers['authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const response = await fetch('/api/auth/me', { headers: this.getHeaders() });
    if (!response.ok) return null;
    const result = (await response.json()) as { data: AuthUser };
    return result.data;
  }

  async getCollections(): Promise<CollectionMeta[]> {
    const response = await fetch(`${this.baseUrl}/collections`);
    if (!response.ok) throw new Error(`Failed to fetch collections: ${response.status}`);
    const result = (await response.json()) as { data: CollectionMeta[] };
    return result.data;
  }

  async getDocuments<T = Record<string, unknown>>(collection: string): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/${collection}`);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
    const result = (await response.json()) as ApiListResponse<T>;
    return result.data;
  }

  async getDocument<T = Record<string, unknown>>(collection: string, id: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`);
    if (!response.ok) throw new Error(`Failed to fetch document: ${response.status}`);
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async createDocument<T = Record<string, unknown>>(
    collection: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`Failed to create document: ${response.status}`);
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async updateDocument<T = Record<string, unknown>>(
    collection: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`Failed to update document: ${response.status}`);
    const result = (await response.json()) as ApiItemResponse<T>;
    return result.data;
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!response.ok) throw new Error(`Failed to delete document: ${response.status}`);
  }
}
