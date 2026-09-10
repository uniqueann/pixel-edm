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
      activity_logs: {
        Row: {
          id: string;
          workspace_id: string;
          actor_id: string | null;
          actor_name: string;
          actor_role: string;
          action: string;
          target_type: string;
          target_id: string | null;
          target_label: string;
          metadata: Json;
          dedupe_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          actor_id?: string | null;
          actor_name: string;
          actor_role: string;
          action: string;
          target_type: string;
          target_id?: string | null;
          target_label?: string;
          metadata?: Json;
          dedupe_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          actor_id?: string | null;
          actor_name?: string;
          actor_role?: string;
          action?: string;
          target_type?: string;
          target_id?: string | null;
          target_label?: string;
          metadata?: Json;
          dedupe_key?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      contact_import_rows: {
        Row: {
          import_id: string;
          workspace_id: string;
          item_no: number;
          source_rows: string;
          email: string;
          name: string;
          tags: string;
          requested_status: string;
          consent_source: string | null;
          consent_note: string | null;
          consent_at: string | null;
          preview_result: string;
          result: string;
          message: string;
          contact_id: string | null;
          processed_at: string | null;
        };
        Insert: {
          import_id: string;
          workspace_id: string;
          item_no: number;
          source_rows: string;
          email: string;
          name?: string;
          tags?: string;
          requested_status: string;
          consent_source?: string | null;
          consent_note?: string | null;
          consent_at?: string | null;
          preview_result: string;
          result?: string;
          message?: string;
          contact_id?: string | null;
          processed_at?: string | null;
        };
        Update: {
          import_id?: string;
          workspace_id?: string;
          item_no?: number;
          source_rows?: string;
          email?: string;
          name?: string;
          tags?: string;
          requested_status?: string;
          consent_source?: string | null;
          consent_note?: string | null;
          consent_at?: string | null;
          preview_result?: string;
          result?: string;
          message?: string;
          contact_id?: string | null;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      contact_imports: {
        Row: {
          id: string;
          workspace_id: string;
          source_type: string;
          source_name: string;
          consent_declared: boolean;
          consent_source: string | null;
          consent_note: string | null;
          consent_at: string | null;
          status: string;
          total_source_rows: number;
          total_groups: number;
          processed_groups: number;
          summary: Json;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          source_type: string;
          source_name: string;
          consent_declared?: boolean;
          consent_source?: string | null;
          consent_note?: string | null;
          consent_at?: string | null;
          status?: string;
          total_source_rows: number;
          total_groups: number;
          processed_groups?: number;
          summary?: Json;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          source_type?: string;
          source_name?: string;
          consent_declared?: boolean;
          consent_source?: string | null;
          consent_note?: string | null;
          consent_at?: string | null;
          status?: string;
          total_source_rows?: number;
          total_groups?: number;
          processed_groups?: number;
          summary?: Json;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
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
          subscription_status: string;
          consent_source: string | null;
          consent_note: string | null;
          consent_at: string | null;
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
          subscription_status?: string;
          consent_source?: string | null;
          consent_note?: string | null;
          consent_at?: string | null;
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
          subscription_status?: string;
          consent_source?: string | null;
          consent_note?: string | null;
          consent_at?: string | null;
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
      subscription_events: {
        Row: {
          id: string;
          workspace_id: string;
          contact_id: string | null;
          email: string;
          event_type: string;
          source: string;
          note: string;
          consent_at: string | null;
          import_id: string | null;
          import_item_no: number | null;
          metadata: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          contact_id?: string | null;
          email: string;
          event_type: string;
          source: string;
          note?: string;
          consent_at?: string | null;
          import_id?: string | null;
          import_item_no?: number | null;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          contact_id?: string | null;
          email?: string;
          event_type?: string;
          source?: string;
          note?: string;
          consent_at?: string | null;
          import_id?: string | null;
          import_item_no?: number | null;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      suppressions: {
        Row: {
          workspace_id: string;
          email: string;
          reason: string;
          first_event_id: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          email: string;
          reason: string;
          first_event_id: string;
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          email?: string;
          reason?: string;
          first_event_id?: string;
          created_at?: string;
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
      templates: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          category: string;
          subject: string;
          body: string;
          default_key: string | null;
          source_template_id: string | null;
          archived_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          category: string;
          subject: string;
          body: string;
          default_key?: string | null;
          source_template_id?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          category?: string;
          subject?: string;
          body?: string;
          default_key?: string | null;
          source_template_id?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
          version?: number;
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
      prepare_contact_import: { Args: { payload: Json }; Returns: Json };
      confirm_contact_import: { Args: { payload: Json }; Returns: Json };
      process_contact_import_batch: { Args: { payload: Json }; Returns: Json };
      get_contact_import: { Args: { payload: Json }; Returns: Json };
      list_contact_imports: { Args: { payload: Json }; Returns: Json };
      export_contact_import: { Args: { payload: Json }; Returns: Json };
      unsubscribe_contact: { Args: { payload: Json }; Returns: string };
      save_template: { Args: { payload: Json }; Returns: string };
      duplicate_template: { Args: { payload: Json }; Returns: string };
      set_template_archived: { Args: { payload: Json }; Returns: string };
      list_templates: { Args: { payload: Json }; Returns: Json };
      list_activity_logs: { Args: { payload: Json }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
