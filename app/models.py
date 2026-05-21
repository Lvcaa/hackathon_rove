from pydantic import BaseModel
from typing import Optional


class UserLocation(BaseModel):
    lat: float
    lng: float


class TripSearchRequest(BaseModel):
    destination: str
    user_location: Optional[UserLocation] = None


class TripBookRequest(BaseModel):
    option_id: str


class SetCapacityRequest(BaseModel):
    max_capacity: int


class SensorUpdateRequest(BaseModel):
    available_spots: int
