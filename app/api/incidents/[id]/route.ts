/**
 * PATCH /api/incidents/[id] → actualiza status/notes.
 * DELETE /api/incidents/[id] → borra el video del bucket + la fila.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { z } from 'zod';

const BUCKET = 'incident-videos';

const PatchBody = z.object({
  status: z.enum(['open', 'in_review', 'closed']).optional(),
  notes: z.string().max(5000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 });
  }

  try {
    const supabase = getServerSupabaseClient();
    const result = await (
      supabase.from('incidents') as unknown as {
        update: (v: typeof parsed.data) => {
          eq: (c: string, v: number) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update(parsed.data)
      .eq('id', Number(id));

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const supabase = getServerSupabaseClient();

    // Leer la fila para conocer el video_path
    const selectResult = await (
      supabase.from('incidents') as unknown as {
        select: (c: string) => {
          eq: (c: string, v: number) => {
            single: () => Promise<{ data: { video_path: string } | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .select('video_path')
      .eq('id', Number(id))
      .single();

    if (selectResult.error || !selectResult.data) {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 });
    }

    // Borrar archivo del bucket
    await supabase.storage.from(BUCKET).remove([selectResult.data.video_path]);

    // Borrar fila
    const deleteResult = await (
      supabase.from('incidents') as unknown as {
        delete: () => { eq: (c: string, v: number) => Promise<{ error: { message: string } | null }> };
      }
    )
      .delete()
      .eq('id', Number(id));

    if (deleteResult.error) {
      return NextResponse.json({ success: false, error: deleteResult.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
