import { errorResponse, parseDirection, requiredParam } from "@/lib/api";
import { getSeatChanceRepository } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lineNo = requiredParam(params, "line_no");
    const direction = parseDirection(requiredParam(params, "direction"));
    const layout = await getSeatChanceRepository().getTrainLayout(lineNo, direction);

    if (!layout) {
      return Response.json(
        {
          error: {
            message: "해당 노선/방향의 열차 레이아웃 데이터가 없습니다."
          }
        },
        { status: 404 }
      );
    }

    return Response.json({
      line_no: layout.lineNo,
      direction: layout.direction,
      car_count: layout.carCount,
      doors_per_car: layout.doorsPerCar,
      source: layout.source,
      confidence: layout.confidence
    });
  } catch (error) {
    return errorResponse(error);
  }
}

