import { NextResponse } from 'next/server';
import { getEmpresasFleteras } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('🏢 API /empresas - Fetching empresas fleteras from AS400');
    
    const empresas = await getEmpresasFleteras();

    console.log(`✅ API /empresas - Returning ${empresas.length} empresas`);

    return NextResponse.json({
      success: true,
      count: empresas.length,
      data: empresas,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch empresas fleteras',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
