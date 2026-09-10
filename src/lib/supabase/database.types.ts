// 由迁移对应的数据库结构生成，请运行 npm run db:types 更新。
type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type Database = {
  edm: {
    Tables: {
      contact_tags: {
        Row: { workspace_id: string; contact_id: string; tag_id: string };
        Insert: { workspace_id: string; contact_id: string; tag_id: string };
        Update: { workspace_id?: string; contact_id?: string; tag_id?: string };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          name: string;
          archived_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          name?: string;
          archived_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string;
          name?: string;
          archived_at?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      members: {
        Row: {
          user_id: string;
          status: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          status?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          status?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          normalized_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          normalized_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          normalized_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: string;
          status: string;
          joined_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role: string;
          status?: string;
          joined_at?: string;
        };
        Update: {
          workspace_id?: string;
          user_id?: string;
          role?: string;
          status?: string;
          joined_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          type: string;
          plan: string;
          owner_id: string;
          bootstrap_owner_id: string | null;
          mailing_address: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          type?: string;
          plan?: string;
          owner_id: string;
          bootstrap_owner_id?: string | null;
          mailing_address?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          type?: string;
          plan?: string;
          owner_id?: string;
          bootstrap_owner_id?: string | null;
          mailing_address?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      initialize_member: { Args: Record<string, never>; Returns: string };
      save_contact: { Args: { payload: Json }; Returns: string };
      archive_contact: { Args: { payload: Json }; Returns: string };
      list_contacts: { Args: { payload: Json }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
