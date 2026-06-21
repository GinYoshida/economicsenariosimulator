from datetime import datetime

from pydantic import BaseModel, HttpUrl


class Source(BaseModel):
    series_id: str          # 内部ID 例 "household.food.real_yoy"
    name: str               # 出典名 例 "総務省 家計調査"
    url: HttpUrl            # 出典URL
    retrieved_at: datetime  # 取得日時(UTC)
    license: str            # 利用条件/ライセンス
    unit: str               # 単位 例 "yoy_pct"
    frequency: str          # "monthly"
