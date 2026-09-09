// 由迁移对应的数据库结构生成，请运行 npm run db:types 更新。
export type Database = {
  edm: {
    Tables: {
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
